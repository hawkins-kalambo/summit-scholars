-- Optional initial PUBLIC catalogue only. No users, grades or fees are seeded.
begin;
insert into public.universities(id, code, name, active)
values ('10000000-0000-4000-8000-000000000001', 'MZUNI', 'Mzuzu University', true)
on conflict do nothing;
insert into public.courses(university_id, code, name, description, level, published)
values
 ('10000000-0000-4000-8000-000000000001', 'SSB-PRECALC', 'Precalculus', 'Functions and foundational mathematics', 1, true),
 ('10000000-0000-4000-8000-000000000001', 'SSB-BIO', 'General Biology', 'Cells, genetics and living systems', 1, true),
 ('10000000-0000-4000-8000-000000000001', 'SSB-PHY1', 'General Physics I', 'Mechanics, forces and energy', 1, true),
 ('10000000-0000-4000-8000-000000000001', 'SSB-CHEM1', 'General Chemistry I', 'Matter and chemical reactions', 1, true),
 ('10000000-0000-4000-8000-000000000001', 'SSB-COMMS', 'Communication Skills', 'Academic writing and presentations', 1, true),
 ('10000000-0000-4000-8000-000000000001', 'SSB-COMP', 'End User Computing', 'Digital productivity skills', 1, true)
on conflict do nothing;
commit;
