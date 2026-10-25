-- Het Potje (553 strategieën, xinix-sim-background) staat uit op verzoek van de gebruiker (2026-10-25).
-- Alleen de planning gaat uit; strategieën, posities en historie blijven staan. Terugzetten:
-- select cron.alter_job(jobid, active := true) from cron.job where jobname in ('xinix-sim-daily', 'xinix-evolve-biannual');
select cron.alter_job(jobid, active := false)
from cron.job
where jobname in ('xinix-sim-daily', 'xinix-evolve-biannual');
