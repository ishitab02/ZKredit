import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import Mermaid from "./Mermaid";

const components: Components = {
  code({ className, children, ...rest }) {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match?.[1] === "mermaid") {
      return <Mermaid chart={String(children).replace(/\n$/, "")} />;
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
};

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="docs-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
