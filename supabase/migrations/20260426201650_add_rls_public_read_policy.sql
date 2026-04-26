
  create policy "Enable read access for all users"
  on "public"."chains"
  as permissive
  for select
  to public
using (true);



  create policy "Enable read access for all users"
  on "public"."loans"
  as permissive
  for select
  to public
using (true);



  create policy "Enable read access for all users"
  on "public"."tokens"
  as permissive
  for select
  to public
using (true);



  create policy "Enable read access for all users"
  on "public"."transactions"
  as permissive
  for select
  to public
using (true);



