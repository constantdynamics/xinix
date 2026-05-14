-- Smart exit: partial exit tracking voor deelwinstverkopen.
-- partial_exits JSONB array: [{qty_sold, net_proceeds, at, reason}]
-- Laat strategieën toe om delen van posities vroegtijdig te verkopen.

ALTER TABLE xinix_strategy_positions
  ADD COLUMN IF NOT EXISTS partial_exits JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE xinix_paper_positions
  ADD COLUMN IF NOT EXISTS partial_exits JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN xinix_strategy_positions.partial_exits IS
  'Gedeeltelijke exits: [{qty_sold, net_proceeds, at, reason}]';
COMMENT ON COLUMN xinix_paper_positions.partial_exits IS
  'Gedeeltelijke exits: [{qty_sold, net_proceeds, at, reason}]';
