import { useEffect, useMemo, useState } from "react";
import type { SpecPage } from "../spec.js";
import { HostFilesContext } from "../host/files.ts";
import { ChangesLoaderContext } from "./changesSource.ts";
import {
  embeddedChangesLoader,
  pageHash,
  parseHash,
  type EmbeddedContent,
} from "./embedded.ts";
import { ViewerApp } from "./ViewerApp.tsx";

type Route = { page: SpecPage; headingId: string | undefined };

function readRoute(pages: SpecPage[]): Route {
  const parsed = parseHash(window.location.hash, pages);
  return parsed ?? { page: pages[0]!, headingId: undefined };
}

/** A spec read from the page itself, with no server. The page lives in the hash, so a host that hides it only loses deep links. */
export function EmbeddedApp(props: { content: EmbeddedContent }) {
  const { content } = props;
  const pages = useMemo(
    () => content.pages.map((entry) => entry.page),
    [content],
  );
  const [route, setRoute] = useState(() => readRoute(pages));
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      // A bare `#heading` is the table of contents moving within the page.
      if (hash === "" || hash.startsWith("#/")) setRoute(readRoute(pages));
    };
    window.addEventListener("popstate", onHashChange);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onHashChange);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [pages]);

  const entry =
    content.pages.find(
      (candidate) => candidate.page.file === route.page.file,
    ) ?? content.pages[0]!;
  const loadChanges = useMemo(() => embeddedChangesLoader(content), [content]);
  return (
    <HostFilesContext.Provider value={content.files}>
      <ChangesLoaderContext.Provider value={loadChanges}>
        <ViewerApp
          // Each page has its own comments, Reviewed files, and Diff panel.
          key={entry.page.file}
          document={entry.document}
          mode="gist"
          spec={{
            title: content.title,
            pages,
            current: entry.page,
            href: (page) => pageHash(page) || "#/",
            navigate: (page, hash) => {
              const headingId =
                hash === "" ? undefined : decodeURIComponent(hash.slice(1));
              try {
                window.history.pushState({}, "", pageHash(page, headingId));
              } catch {
                // The host forbids writing the address, so the page still changes in state alone.
              }
              setRoute({ page, headingId });
            },
            headingHash: (id) => pageHash(entry.page, id),
            headingId: () => route.headingId ?? "",
          }}
        />
      </ChangesLoaderContext.Provider>
    </HostFilesContext.Provider>
  );
}
