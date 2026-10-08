import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface Player {
  currentTime: number;
  playing: boolean;
  /** Shuttle speed: 0 = stopped, ±1/2/4/8 (negative = reverse, J). */
  shuttle: number;
  loop: { start: number; end: number } | null;
  seek: (t: number) => void;
  /**
   * Shows the frame at `t` without moving the playhead (pauses playback); `null` returns the
   * video to the playhead.
   */
  preview: (t: number | null) => void;
  togglePlay: () => void;
  pause: () => void;
  stepFrames: (n: number) => void;
  stepSeconds: (s: number) => void;
  shuttleForward: () => void;
  shuttleReverse: () => void;
  stop: () => void;
  playLoop: (start: number, end: number) => void;
  clearLoop: () => void;
}

const REVERSE_TICK_MS = 50;

/** Controls an HTML5 <video>: frame-accurate seeking, J/K/L shuttle, looping a range. */
export const usePlayer = (
  videoRef: RefObject<HTMLVideoElement | null>,
  fps: number,
  duration: number,
): Player => {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shuttle, setShuttle] = useState(0);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const reverseTimer = useRef<number | null>(null);
  const currentRef = useRef(currentTime);
  currentRef.current = currentTime;
  const previewing = useRef(false);

  const clampT = useCallback((t: number) => Math.max(0, Math.min(duration, t)), [duration]);

  const stopReverse = () => {
    if (reverseTimer.current !== null) window.clearInterval(reverseTimer.current);
    reverseTimer.current = null;
  };

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const target = clampT(t);
      setCurrentTime(target);
      if (v) v.currentTime = target;
    },
    [videoRef, clampT],
  );

  // Track time smoothly while playing (timeupdate is only ~4 Hz).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const l = loopRef.current;
      if (l && v.currentTime >= l.end) v.currentTime = l.start;
      setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      if (!previewing.current) setCurrentTime(v.currentTime);
    };
    const onSeeked = () => {
      if (v.paused && !previewing.current) setCurrentTime(v.currentTime);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [videoRef]);

  useEffect(() => stopReverse, []);

  const pause = useCallback(() => {
    stopReverse();
    setShuttle(0);
    videoRef.current?.pause();
  }, [videoRef]);

  const play = useCallback(
    (rate = 1) => {
      const v = videoRef.current;
      if (!v) return;
      stopReverse();
      v.playbackRate = rate;
      void v.play();
    },
    [videoRef],
  );

  const preview = useCallback(
    (t: number | null) => {
      const v = videoRef.current;
      if (!v) return;
      if (t === null) {
        if (!previewing.current) return;
        previewing.current = false;
        v.currentTime = currentRef.current;
        return;
      }
      if (!previewing.current) {
        // Keep the playhead where playback was when the preview started.
        setCurrentTime(v.currentTime);
        currentRef.current = v.currentTime;
        previewing.current = true;
        pause();
      }
      v.currentTime = clampT(t);
    },
    [videoRef, clampT, pause],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused && reverseTimer.current === null) {
      setShuttle(1);
      play(1);
    } else pause();
  }, [videoRef, play, pause]);

  const stepFrames = useCallback(
    (n: number) => {
      pause();
      const v = videoRef.current;
      const base = v ? v.currentTime : currentTime;
      seek(Math.round(base * fps + n) / fps);
    },
    [pause, seek, fps, currentTime, videoRef],
  );

  const stepSeconds = useCallback(
    (s: number) => {
      const v = videoRef.current;
      seek((v ? v.currentTime : currentTime) + s);
    },
    [seek, currentTime, videoRef],
  );

  const shuttleForward = useCallback(() => {
    const next = shuttle <= 0 ? 1 : Math.min(8, shuttle * 2);
    setShuttle(next);
    play(next);
  }, [shuttle, play]);

  const shuttleReverse = useCallback(() => {
    const next = shuttle >= 0 ? -1 : Math.max(-8, shuttle * 2);
    setShuttle(next);
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    stopReverse();
    // Browsers cannot play backwards: emulate by stepping back on a timer.
    reverseTimer.current = window.setInterval(() => {
      const t = v.currentTime + (next * REVERSE_TICK_MS) / 1000;
      if (t <= 0) {
        stopReverse();
        setShuttle(0);
      }
      v.currentTime = Math.max(0, t);
      setCurrentTime(v.currentTime);
    }, REVERSE_TICK_MS);
  }, [shuttle, videoRef]);

  const playLoop = useCallback(
    (start: number, end: number) => {
      setLoop({ start, end });
      seek(start);
      setShuttle(1);
      play(1);
    },
    [seek, play],
  );

  const clearLoop = useCallback(() => setLoop(null), []);

  return {
    currentTime,
    playing,
    shuttle,
    loop,
    seek,
    preview,
    togglePlay,
    pause,
    stepFrames,
    stepSeconds,
    shuttleForward,
    shuttleReverse,
    stop: pause,
    playLoop,
    clearLoop,
  };
};
