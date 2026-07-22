import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import PageNav from "../components/PageNav";
import TableOfContents from "../components/TableOfContents";
import { DEFAULT_SLUG, getAdjacentPages, getPage } from "../lib/nav";

export default function DocPage() {
  const params = useParams<{ "*": string }>();
  const slug = params["*"] || DEFAULT_SLUG;
  const page = getPage(slug);

  useEffect(() => {
    if (page) document.title = `${page.title} - ZKredit Docs`;
    window.scrollTo({ top: 0 });
  }, [page]);

  if (!page) return <Navigate to={`/${DEFAULT_SLUG}`} replace />;

  const { prev, next } = getAdjacentPages(page.slug);

  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 pb-24">
        <p className="eyebrow mb-4">
          <span className="eyebrow-dot" />
          {page.description}
        </p>
        <Markdown content={page.content} />
        <PageNav prev={prev} next={next} />
      </article>
      <TableOfContents pageKey={page.slug} />
    </div>
  );
}
