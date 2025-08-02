-- スキーマ dev への usage 権限を与える
grant usage on schema dev to anon;
grant usage on schema dev to authenticated;

-- dev スキーマ内のすべてのテーブルに対して select などの操作を許可
grant select, insert, update, delete on all tables in schema dev to anon;
grant select, insert, update, delete on all tables in schema dev to authenticated;

-- 将来的に dev スキーマに新しいテーブルが追加されたときも、自動で権限が付与されるようにする
alter default privileges in schema dev grant select, insert, update, delete on tables to anon;
alter default privileges in schema dev grant select, insert, update, delete on tables to authenticated;


-- スキーマ test への usage 権限を与える
grant usage on schema test to anon;
grant usage on schema test to authenticated;

-- test スキーマ内のすべてのテーブルに対して select などの操作を許可
grant select, insert, update, delete on all tables in schema test to anon;
grant select, insert, update, delete on all tables in schema test to authenticated;

-- 将来的に test スキーマに新しいテーブルが追加されたときも、自動で権限が付与されるようにする
alter default privileges in schema test grant select, insert, update, delete on tables to anon;
alter default privileges in schema test grant select, insert, update, delete on tables to authenticated;