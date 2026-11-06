"use client";

import { useEffect, useRef, useState } from "react";
import { downsampler, segmenter, toWav, type Segment } from "@/lib/voice/talk";
import { keyHeaders } from "@/lib/userKey";

/** Keeps the screen on while building. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const get = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) lock.release();
      } catch {
        /* denied or unsupported */
      }
    };
    get();
    const onVis = () => {
      if (document.visibilityState === "visible" && !cancelled) get();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export type Mic = "off" | "asking" | "on" | "paused" | "denied" | "busy" | "nomic" | "unsupported" | "offline" | "refused" | "credits";

type Ctx = typeof AudioContext;
const AudioCtx = () => (typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctx }).webkitAudioContext));

/** Every browser that can open a mic can listen: it's the same code everywhere, with no browser speech service. */
export function micSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!AudioCtx();
}

let shared: AudioContext | null = null;
const worklets = new WeakSet<AudioContext>();

/** Call inside the tap that turns the voice on: Safari only lets audio start from a tap. */
export function primeListening() {
  try {
    const C = AudioCtx();
    if (!C) return;
    shared ??= new C();
    shared.resume().catch(() => {});
  } catch {
    /* no audio */
  }
}

/**
 * Listens while voice mode is on. The page opens the mic itself, with echo
 * cancelling, so the voice playing from the same speakers is mostly gone
 * before anything else hears it; each time someone talks, that piece goes to
 * Whisper on OpenRouter (/api/listen) and onHeard gets the text, with the
 * piece's times so her own words can be told apart. onHeard returns what it
 * acted on, to show as "Heard ...", or null. `her` says whether the voice is
 * playing, so what's left of her in the mic isn't taken for someone talking.
 * It runs on the person's own key: a new key (or a new `key` token, after a
 * top-up) starts it afresh.
 */
export function useListener(enabled: boolean, key: string, onHeard: (text: string, seg: Segment) => string | null, her: () => boolean) {
  const cb = useRef(onHeard);
  const herRef = useRef(her);
  useEffect(() => {
    cb.current = onHeard;
    herRef.current = her;
  });
  const [mic, setMic] = useState<Mic>("off");
  const [heard, setHeard] = useState("");

  useEffect(() => {
    const C = AudioCtx();
    if (!enabled || !micSupported() || !C) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let nodes: AudioNode[] = [];
    let retry: ReturnType<typeof setTimeout> | undefined;
    let asking: ReturnType<typeof setTimeout> | undefined;
    let clear: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let fails = 0;
    let inflight = 0;
    // a key turned away, or an account out of credit, fails every piece the same way: stop sending
    let dead = false;
    // a piece that overlaps one already acted on can't act again
    let acted = 0;
    let cut = segmenter();
    const hidden = () => document.visibilityState === "hidden";

    const send = async (seg: Segment) => {
      // a noisy room: drop a piece rather than queue it behind others
      if (inflight >= 3 || dead) return;
      inflight++;
      try {
        const r = await fetch("/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav", ...keyHeaders() }, body: toWav(seg.pcm), signal: AbortSignal.timeout(9000) });
        if (stop) return;
        if (r.status === 401 || r.status === 402) {
          // nothing more will be heard on this key: the mic goes off too, so no recording light stays on for nothing
          dead = true;
          release();
          setMic(r.status === 401 ? "refused" : "credits");
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const text = String(((await r.json()) as { text?: unknown }).text ?? "");
        fails = 0;
        setMic((m) => (m === "offline" ? "on" : m));
        if (!text.trim() || seg.start < acted) return;
        const did = cb.current(text, seg);
        if (!did) return;
        acted = seg.end;
        setHeard(did);
        clearTimeout(clear);
        clear = setTimeout(() => setHeard(""), 2400);
      } catch {
        if (!stop && !dead && ++fails >= 3) setMic("offline");
      } finally {
        inflight--;
      }
    };

    const frame = (pcm: Float32Array) => {
      if (stop) return;
      const seg = cut(pcm, Date.now(), herRef.current());
      if (seg) send(seg);
    };

    // Safari won't start audio again after the screen locks until there's a tap
    let wake: (() => void) | null = null;
    const unwake = () => {
      if (wake) document.removeEventListener("pointerdown", wake);
      wake = null;
    };

    const release = () => {
      clearTimeout(asking);
      unwake();
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already */
        }
        if (n instanceof AudioWorkletNode) n.port.onmessage = null;
        if (n instanceof ScriptProcessorNode) n.onaudioprocess = null;
      }
      nodes = [];
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const open = async () => {
      if (stop || dead || stream || hidden()) return;
      // only say "allow the mic" when the browser is actually asking
      asking = setTimeout(() => setMic((m) => (m === "on" ? m : "asking")), 500);
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
      } catch (e) {
        clearTimeout(asking);
        if (stop) return;
        const name = (e as Error).name;
        if (name === "NotAllowedError" || name === "SecurityError") setMic("denied");
        else if (name === "NotFoundError" || name === "OverconstrainedError") setMic("nomic");
        else if (name === "TypeError") setMic("unsupported");
        else {
          // a call or another app has the mic: try again a few times, then say so
          setMic("busy");
          if (++tries < 4) retry = setTimeout(open, 1500 * tries);
        }
        return;
      }
      clearTimeout(asking);
      if (stop || hidden()) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      tries = 0;
      try {
        const ctx = (shared ??= new C());
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(s);
        // nodes only run when something downstream pulls, so the frames end in silence
        const sink = ctx.createGain();
        sink.gain.value = 0;
        sink.connect(ctx.destination);
        let tap: AudioNode;
        try {
          if (!ctx.audioWorklet) throw new Error("no worklet");
          if (!worklets.has(ctx)) {
            await ctx.audioWorklet.addModule("/listen-worklet.js");
            worklets.add(ctx);
          }
          const w = new AudioWorkletNode(ctx, "bygga-listen", { channelCount: 1, channelCountMode: "explicit" });
          w.port.onmessage = (e: MessageEvent<Float32Array>) => frame(e.data);
          tap = w;
        } catch {
          // older browsers: the same frames from the main thread
          const sp = ctx.createScriptProcessor(4096, 1, 1);
          const down = downsampler(ctx.sampleRate, frame);
          sp.onaudioprocess = (e) => down(e.inputBuffer.getChannelData(0));
          tap = sp;
        }
        if (stop || stream !== s) return;
        src.connect(tap);
        tap.connect(sink);
        nodes = [src, tap, sink];
        cut = segmenter();
        if (dead) return;
        if (ctx.state === "running") setMic("on");
        else {
          setMic("paused");
          unwake();
          wake = () => {
            unwake();
            ctx.resume().then(() => !stop && !dead && stream === s && setMic(ctx.state === "running" ? "on" : "paused"), () => {});
          };
          document.addEventListener("pointerdown", wake);
        }
        // a mic unplugged, or taken by a call, ends the track: open it again
        s.getAudioTracks()[0]?.addEventListener("ended", () => {
          if (stream !== s) return;
          release();
          if (!stop) retry = setTimeout(open, 800);
        });
      } catch {
        release();
        setMic("unsupported");
      }
    };

    const onVis = () => {
      if (hidden()) release();
      else open();
    };
    document.addEventListener("visibilitychange", onVis);
    open();
    return () => {
      stop = true;
      clearTimeout(retry);
      clearTimeout(clear);
      document.removeEventListener("visibilitychange", onVis);
      release();
      setMic("off");
    };
  }, [enabled, key]);

  if (!enabled) return { mic: "off" as Mic, heard: "" };
  return { mic: micSupported() ? mic : ("unsupported" as Mic), heard };
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
