import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import MobileView from "./view";

export default async function MobilePage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  return <MobileView />;
}
