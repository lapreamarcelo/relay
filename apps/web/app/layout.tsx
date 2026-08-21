import "./globals.css";

export const metadata = {
  title: "Relay — Publish once. Everywhere.",
  description: "The open-source publishing layer for social networks.",
};

const restoreTheme = `try{const theme=localStorage.getItem("relay-theme");if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: restoreTheme }} /></head><body>{children}</body></html>;
}
