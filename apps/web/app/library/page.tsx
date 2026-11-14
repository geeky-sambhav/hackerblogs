import type { Metadata } from "next";
import { Library } from "@/components/library";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = { title: "Your library" };

export default function LibraryPage() {
  return (
    <>
      <PageTitle title="Your library">
        Saved, liked and opened pieces live only in this browser. There are no accounts. Export a file to move them to
        another device.
      </PageTitle>
      <Library />
    </>
  );
}
