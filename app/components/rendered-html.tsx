import type { RenderedHtml } from "~/lib/text";

export function RenderedHtmlBlock({
  html,
  className,
}: {
  html: RenderedHtml | "";
  className?: string;
}) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- Only the Markdown renderers produce this type.
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
