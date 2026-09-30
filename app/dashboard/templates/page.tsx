import { TemplatesManager } from "@/components/templates-manager";
import PageHeading from "@/components/ui/page-heading";

export default function TemplatesPage() {
  return (
    <>
      <PageHeading
        title="قوالب الرسائل"
        preTitle="رسائل جاهزة"
      />
      <TemplatesManager />
    </>
  );
}