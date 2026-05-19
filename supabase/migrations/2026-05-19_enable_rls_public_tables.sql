-- Zet RLS aan op alle publieke tabellen die nog zonder RLS stonden.
-- Geen policies = standaard "deny all" voor anon/authenticated rollen.
-- Edge functions blijven werken want die gebruiken de service_role key
-- die RLS automatisch bypassed. De frontend gebruikt geen directe
-- Supabase client — alle DB-toegang loopt via edge functions.
alter table public.xinix_paper_positions    enable row level security;
alter table public.xinix_paper_state        enable row level security;
alter table public.xinix_paper_equity       enable row level security;
alter table public.xinix_strategies         enable row level security;
alter table public.xinix_strategy_equity    enable row level security;
alter table public.xinix_strategy_positions enable row level security;
alter table public.xinix_knowledge_exports  enable row level security;
alter table public.xinix_paper_config       enable row level security;
alter table public.xinix_strategy_state     enable row level security;
alter table public.market_regime            enable row level security;
alter table public.zwitserleven_stocks      enable row level security;
alter table public.xinix_favorites          enable row level security;
alter table public.xinix_seen               enable row level security;
