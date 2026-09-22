"use client";

import { useEffect, useState } from "react";

/**
 * What the place actually looks like.
 *
 * A score tells you whether today is a good day; it does not tell you whether
 * you want to be there at all. This pulls a short description and a few
 * photos so a reader can decide "is this the kind of trail I'm after?"
 * before committing to the drive.
 *
 * Everything here comes from Wikipedia and Wikimedia Commons, which are
 * openly licensed and allow cross-origin requests, so the photos are
 * credited and linked back rather than copied in. It loads after the report
 * and fails silently: this is context, and the forecast must never wait on
 * it.
 */

interface Photo {
  src: string;
  page: string;
  credit: string;
}

interface Look {
  summary: string | null;
  summaryTitle: string | null;
  photos: Photo[];
}

const CACHE = new Map<string, Look>();

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchJson(url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadLook(name: string, region: string, signal: AbortSignal): Promise<Look> {
  const query = encodeURIComponent(`${name} ${region.replace(/ County$/, "")} Utah`);

  const wiki = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}` +
      `&gsrlimit=1&prop=extracts&exintro=1&explaintext=1&exsentences=3&format=json&origin=*`,
    signal,
  );

  let summary: string | null = null;
  let summaryTitle: string | null = null;
  const pages = (wiki?.["query"] as { pages?: Record<string, unknown> } | undefined)?.pages;
  for (const page of Object.values(pages ?? {})) {
    const entry = page as { title?: string; extract?: string };
    if (entry.extract && entry.extract.length > 60) {
      summary = stripHtml(entry.extract);
      summaryTitle = entry.title ?? null;
    }
    break;
  }

  const commons = await fetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(`${name} Utah`)}&gsrnamespace=6&gsrlimit=8` +
      `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=500&format=json&origin=*`,
    signal,
  );

  const photos: Photo[] = [];
  const files = (commons?.["query"] as { pages?: Record<string, unknown> } | undefined)?.pages;
  for (const file of Object.values(files ?? {})) {
    const entry = file as {
      title?: string;
      imageinfo?: {
        thumburl?: string;
        descriptionurl?: string;
        extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
      }[];
    };
    const info = entry.imageinfo?.[0];
    if (!info?.thumburl || !/\.(jpe?g|png)$/i.test(entry.title ?? "")) continue;
    const artist = stripHtml(info.extmetadata?.Artist?.value ?? "") || "Wikimedia Commons";
    const licence = info.extmetadata?.LicenseShortName?.value ?? "";
    photos.push({
      src: info.thumburl,
      page: info.descriptionurl ?? "https://commons.wikimedia.org",
      credit: licence ? `${artist} · ${licence}` : artist,
    });
    if (photos.length === 4) break;
  }

  return { summary, summaryTitle, photos };
}

export interface TrailLookProps {
  name: string;
  region: string;
  /** The place's own blurb, always shown — this only adds to it. */
  blurb: string;
}

export default function TrailLook({ name, region, blurb }: TrailLookProps) {
  const key = `${name}|${region}`;
  const [look, setLook] = useState<Look | null>(CACHE.get(key) ?? null);
  const [state, setState] = useState<"idle" | "loading" | "done">(
    CACHE.has(key) ? "done" : "idle",
  );

  useEffect(() => {
    if (CACHE.has(key)) {
      setLook(CACHE.get(key) ?? null);
      setState("done");
      return;
    }
    const controller = new AbortController();
    setState("loading");
    setLook(null);
    void loadLook(name, region, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      CACHE.set(key, result);
      setLook(result);
      setState("done");
    });
    return () => controller.abort();
  }, [key, name, region]);

  const search = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${name} ${region} Utah trail`)}`;

  return (
    <section className="look">
      <div className="look-head">
        <h3>What it&rsquo;s like</h3>
        <a className="look-more" href={search} target="_blank" rel="noreferrer noopener">
          More photos ↗
        </a>
      </div>

      <p className="look-blurb">{blurb}</p>

      {state === "loading" ? <p className="look-note">Looking for photos…</p> : null}

      {look?.photos.length ? (
        <div className="look-photos">
          {look.photos.map((photo) => (
            <a key={photo.src} href={photo.page} target="_blank" rel="noreferrer noopener">
              <img src={photo.src} alt={`${name}`} loading="lazy" />
              <span>{photo.credit}</span>
            </a>
          ))}
        </div>
      ) : null}

      {look?.summary ? (
        <p className="look-summary">
          {look.summary}{" "}
          <a
            href={`https://en.wikipedia.org/wiki/${encodeURIComponent(look.summaryTitle ?? name)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Wikipedia ↗
          </a>
        </p>
      ) : null}

      {state === "done" && !look?.summary && !look?.photos.length ? (
        <p className="look-note">
          No open-licensed photos or description found for this one — the link above searches the
          web.
        </p>
      ) : null}
    </section>
  );
}
