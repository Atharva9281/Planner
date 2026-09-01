import Explorer from '../Explorer';

/**
 * The advisor's own account. Empty until two custodian exports are dropped on it, which is what
 * this page shows first — the URL is never dead.
 */
export default function PortfolioPage() {
  return <Explorer slot="portfolio" />;
}
