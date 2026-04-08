alter table public.edges
  add column if not exists string_combined_score integer,
  add column if not exists biogrid_experimental_system_type text,
  add column if not exists hitpredict_confidence text;

create table if not exists public.structure_models (
  model_id text primary key,
  edge text not null references public.edges(edge) on delete cascade,
  protein1 text not null references public.nodes(protein) on delete cascade,
  protein2 text not null references public.nodes(protein) on delete cascade,
  folder_protein1 text not null,
  folder_protein2 text not null,
  variant text not null default 'plain',
  source text not null default 'alphafold3',
  cif_rel_path text not null,
  cif_size_bytes bigint not null,
  summary_confidences_rel_path text not null,
  summary_confidences jsonb not null,
  summary_iptm real,
  summary_ptm real,
  summary_ranking_score real,
  summary_fraction_disordered real,
  summary_has_clash boolean not null default false,
  confidences_rel_path text,
  confidences_size_bytes bigint,
  has_confidences boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint structure_models_variant_check
    check (variant in ('plain', 'without_ag', 'optimize'))
);

create unique index if not exists idx_structure_models_edge_variant
  on public.structure_models(edge, variant);

create index if not exists idx_structure_models_protein1
  on public.structure_models(protein1);

create index if not exists idx_structure_models_protein2
  on public.structure_models(protein2);

alter table public.structure_models enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'structure_models'
      and policyname = 'Allow public read access on structure_models'
  ) then
    create policy "Allow public read access on structure_models"
      on public.structure_models for select
      to anon
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'structure_models'
      and policyname = 'Allow authenticated full access on structure_models'
  ) then
    create policy "Allow authenticated full access on structure_models"
      on public.structure_models for all
      to authenticated
      using (true)
      with check (true);
  end if;
end
$$;
