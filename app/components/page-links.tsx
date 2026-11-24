import { Link, useSearchParams } from "react-router";

export function PageLinks({
  page,
  hasNext,
  label,
  parameter = "page",
}: {
  page: number;
  hasNext: boolean;
  label: string;
  parameter?: string;
}) {
  const [params] = useSearchParams();
  function link(number: number) {
    const next = new URLSearchParams(params);
    next.set(parameter, String(number));
    return `?${next}`;
  }
  if (page === 1 && !hasNext) return null;
  return (
    <nav aria-label={label} className="my-4 flex gap-4 text-sm">
      {page > 1 && (
        <Link className="underline" to={link(page - 1)}>
          Previous
        </Link>
      )}
      <span>Page {page}</span>
      {hasNext && (
        <Link className="underline" to={link(page + 1)}>
          Next
        </Link>
      )}
    </nav>
  );
}
