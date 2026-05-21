-- export_data: jsonb → text.
-- De xinix-full-export edge function bouwt de export-JSON nu zelf incrementeel
-- als string op (tabel voor tabel) en slaat hem rechtstreeks als tekst op.
-- Zo vermijden we de dubbele (de)serialisatie en de jsonb-objectgraaf die
-- eerder een out-of-memory-crash gaven. De GET-download geeft de tekst 1-op-1
-- terug. De tabel is leeg, dus de conversie is triviaal.

alter table xinix_data_exports
  alter column export_data type text using export_data::text;
