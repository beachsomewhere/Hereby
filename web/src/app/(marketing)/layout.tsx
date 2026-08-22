import "./marketing.css";
import { TopNav } from "./TopNav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // .marketing carries the palette as CSS custom properties (see
  // marketing.css) - TopNav lives here, outside each page's own .marketing
  // wrapper, so it needs this on an ancestor to inherit them too.
  return (
    <div className="marketing">
      <TopNav />
      {children}
    </div>
  );
}
