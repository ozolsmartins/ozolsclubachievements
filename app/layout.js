import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Ozols Club Achievements",
  description: "Achievements, leaderboards, and user profiles for ozols.club entries",
  icons: {
    icon: "/OZOLS Favicon ICON.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="lv">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
