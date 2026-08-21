import { AuthoringError } from '../AuthoringError';
import { SLIDE_BUDGET_VH } from '../slideBudget';
import { useMode } from '../../presentation';

export interface VideoEmbedProps {
  /**
   * The video URL, exactly as the reader would paste it from the browser bar.
   * Today: any YouTube URL shape (watch?v=…, youtu.be/…, /shorts/…, or an
   * `/embed/…` URL). The component derives the video id and rewrites into the
   * embeddable form.
   */
  src?: string;
  /**
   * What this video is, in Spanish. Required: an iframe's accessible name
   * comes from `title` and nowhere else.
   */
  title?: string;
  /** How tall the frame is, in px. Capped against the stage on a slide. */
  height?: number;
}

/**
 * The 16:9 comfort height for a YouTube frame. 480 keeps the player readable
 * without swallowing the surrounding text on a book page; the presentation
 * cap `SLIDE_BUDGET_VH` bounds it to the slide's height.
 */
const DEFAULT_HEIGHT = 480;

/**
 * Feature permissions the YouTube iframe player asks for. Matches the shape
 * YouTube's own oEmbed HTML declares (fetched on 2026-08-21): fullscreen,
 * autoplay, accelerometer/gyroscope for VR playback, encrypted-media for DRM,
 * picture-in-picture and web-share for the player's own controls. Dropping any
 * of these makes a subset of videos fail with a "video unavailable" or a
 * silent "Player configuration error".
 */
const ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

/**
 * Extracts a YouTube video id from any of the shapes the reader is likely to
 * paste. Returns `null` if the URL does not look like a YouTube URL — the
 * component turns that into an authoring error.
 */
export function youtubeVideoId(src: string): string | null {
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '');
    // Short link: https://youtu.be/<id>
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0] ?? '';
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      // /watch?v=<id>
      if (url.pathname === '/watch') {
        const v = url.searchParams.get('v');
        return v !== null && /^[A-Za-z0-9_-]{6,}$/.test(v) ? v : null;
      }
      // /embed/<id>
      const embed = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
      if (embed) return embed[1] ?? null;
      // /shorts/<id>
      const short = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
      if (short) return short[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A YouTube video, rendered inline as a playable frame (same shape as
 * `<SheetEmbed>` for spreadsheets). Deliberately the whole of it: the
 * component does not know what the video says, and does not transcode,
 * proxy or transcript it — YouTube plays it and we frame it.
 *
 * Used for external videos recommended alongside a class (see
 * `feedback_videos_in_deck`): the professor references the video in class
 * without pressing play, and readers who want to go deeper have it right on
 * the slide.
 *
 * It paints its own dark player, so on a light-theme page it is a dark
 * rectangle — that is the video's own chrome and is expected. If the video is
 * removed from YouTube the frame paints "Video no disponible", which is the
 * honest failure mode: the platform did the removal, not us.
 */
export function VideoEmbed({ src, title, height = DEFAULT_HEIGHT }: VideoEmbedProps) {
  const mode = useMode();

  if (src === undefined || src === '') {
    return (
      <AuthoringError component="VideoEmbed">
        necesita un src con el enlace del video (YouTube).
      </AuthoringError>
    );
  }
  if (title === undefined || title === '') {
    return (
      <AuthoringError component="VideoEmbed">
        necesita un title que diga qué video es, en español: es lo único que un lector de
        pantalla anuncia de un marco.
      </AuthoringError>
    );
  }

  const id = youtubeVideoId(src);
  if (id === null) {
    return (
      <AuthoringError component="VideoEmbed">
        el src debe ser un enlace de YouTube (youtube.com/watch?v=…,
        youtu.be/…, o /embed/…). Este no sirve: {src}
      </AuthoringError>
    );
  }

  const url = `https://www.youtube.com/embed/${id}`;

  return (
    <div
      className="not-prose relative my-6 rounded bg-sunk"
      style={{
        height: mode === 'presentation' ? `min(${height}px, ${SLIDE_BUDGET_VH}vh)` : `${height}px`,
      }}
    >
      <p
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint"
      >
        Cargando el video…
      </p>
      {/*
       * Deliberately no `sandbox`: an iframe pointing at youtube.com is
       * already in youtube.com's origin, so the browser's default cross-origin
       * boundary is exactly the right restriction — adding a `sandbox`
       * attribute REMOVES capabilities the YouTube player needs (session
       * cookies for logged-in users, storage access, its own postMessage
       * bridge) and hits the reader with a "Player configuration error 153"
       * even for public videos. Contrast with `<SheetEmbed>`, which we DO
       * sandbox because Google Sheets survives it and we prefer the extra
       * isolation for a component the professor shares by link.
       *
       * `referrerPolicy` matches what YouTube's own oEmbed HTML uses; the
       * player performs an origin check for embed-permission and rejects
       * requests with no referrer at all.
       */}
      <iframe
        src={url}
        title={title}
        allow={ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        allowFullScreen
        className="relative h-full w-full rounded border border-rule"
      />
    </div>
  );
}
