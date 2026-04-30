-- pgr-mv.sql — PGR dashboard materialized views
-- Source: pg_dump from a running pgr-services-dev:inbox-filters image
-- Idempotent via DROP ... IF EXISTS CASCADE.
-- pgr-services' DashboardRefreshScheduler refreshes these every minute.

DROP MATERIALIZED VIEW IF EXISTS public.pgr_mv_kpi CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.pgr_mv_monthly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.pgr_mv_monthly_source CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.pgr_mv_dimension CASCADE;








CREATE MATERIALIZED VIEW public.pgr_mv_dimension AS
 SELECT s.tenantid,
    'status'::text AS dimension,
    s.applicationstatus AS dim_value,
    count(*) AS total,
    count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS closed,
    count(*) FILTER (WHERE ((s.applicationstatus)::text <> ALL ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS open_count,
    round(avg(
        CASE
            WHEN ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[])) THEN (((s.lastmodifiedtime - s.createdtime))::numeric / 86400000.0)
            ELSE NULL::numeric
        END), 1) AS avg_resolution_days,
    round(((100.0 * (count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS completion_rate
   FROM public.eg_pgr_service_v2 s
  WHERE (s.active = true)
  GROUP BY s.tenantid, s.applicationstatus
UNION ALL
 SELECT s.tenantid,
    'source'::text AS dimension,
    COALESCE(s.source, 'unknown'::character varying) AS dim_value,
    count(*) AS total,
    count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS closed,
    count(*) FILTER (WHERE ((s.applicationstatus)::text <> ALL ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS open_count,
    round(avg(
        CASE
            WHEN ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[])) THEN (((s.lastmodifiedtime - s.createdtime))::numeric / 86400000.0)
            ELSE NULL::numeric
        END), 1) AS avg_resolution_days,
    round(((100.0 * (count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS completion_rate
   FROM public.eg_pgr_service_v2 s
  WHERE (s.active = true)
  GROUP BY s.tenantid, s.source
UNION ALL
 SELECT s.tenantid,
    'type'::text AS dimension,
    s.servicecode AS dim_value,
    count(*) AS total,
    count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS closed,
    count(*) FILTER (WHERE ((s.applicationstatus)::text <> ALL ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS open_count,
    round(avg(
        CASE
            WHEN ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[])) THEN (((s.lastmodifiedtime - s.createdtime))::numeric / 86400000.0)
            ELSE NULL::numeric
        END), 1) AS avg_resolution_days,
    round(((100.0 * (count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS completion_rate
   FROM public.eg_pgr_service_v2 s
  WHERE (s.active = true)
  GROUP BY s.tenantid, s.servicecode
UNION ALL
 SELECT s.tenantid,
    'boundary'::text AS dimension,
    COALESCE(a.locality, 'Unknown'::character varying) AS dim_value,
    count(*) AS total,
    count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS closed,
    count(*) FILTER (WHERE ((s.applicationstatus)::text <> ALL ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS open_count,
    round(avg(
        CASE
            WHEN ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[])) THEN (((s.lastmodifiedtime - s.createdtime))::numeric / 86400000.0)
            ELSE NULL::numeric
        END), 1) AS avg_resolution_days,
    round(((100.0 * (count(*) FILTER (WHERE ((s.applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS completion_rate
   FROM (public.eg_pgr_service_v2 s
     LEFT JOIN public.eg_pgr_address_v2 a ON (((s.id)::text = (a.parentid)::text)))
  WHERE (s.active = true)
  GROUP BY s.tenantid, a.locality
  WITH NO DATA;




CREATE MATERIALIZED VIEW public.pgr_mv_kpi AS
 SELECT tenantid,
    count(*) AS total,
    count(*) FILTER (WHERE ((applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS closed,
    round(((100.0 * (count(*) FILTER (WHERE ((applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS completion_rate,
    round(avg(
        CASE
            WHEN ((applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[])) THEN (((lastmodifiedtime - createdtime))::numeric / 86400000.0)
            ELSE NULL::numeric
        END), 1) AS avg_resolution_days,
    count(DISTINCT accountid) AS unique_citizens
   FROM public.eg_pgr_service_v2 s
  WHERE (active = true)
  GROUP BY tenantid
  WITH NO DATA;




CREATE MATERIALIZED VIEW public.pgr_mv_monthly AS
 SELECT tenantid,
    to_char(to_timestamp(((createdtime / 1000))::double precision), 'Mon-YYYY'::text) AS month_label,
    (date_trunc('month'::text, to_timestamp(((createdtime / 1000))::double precision)))::date AS month_date,
    count(*) AS total,
    count(*) FILTER (WHERE ((applicationstatus)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS closed,
    count(*) FILTER (WHERE ((applicationstatus)::text <> ALL ((ARRAY['RESOLVED'::character varying, 'CLOSEDAFTERRESOLUTION'::character varying])::text[]))) AS open_count,
    count(DISTINCT accountid) AS unique_citizens
   FROM public.eg_pgr_service_v2 s
  WHERE (active = true)
  GROUP BY tenantid, (to_char(to_timestamp(((createdtime / 1000))::double precision), 'Mon-YYYY'::text)), ((date_trunc('month'::text, to_timestamp(((createdtime / 1000))::double precision)))::date)
  WITH NO DATA;




CREATE MATERIALIZED VIEW public.pgr_mv_monthly_source AS
 SELECT tenantid,
    to_char(to_timestamp(((createdtime / 1000))::double precision), 'Mon-YYYY'::text) AS month_label,
    (date_trunc('month'::text, to_timestamp(((createdtime / 1000))::double precision)))::date AS month_date,
    COALESCE(source, 'unknown'::character varying) AS source,
    count(*) AS total
   FROM public.eg_pgr_service_v2 s
  WHERE (active = true)
  GROUP BY tenantid, (to_char(to_timestamp(((createdtime / 1000))::double precision), 'Mon-YYYY'::text)), ((date_trunc('month'::text, to_timestamp(((createdtime / 1000))::double precision)))::date), source
  WITH NO DATA;




CREATE UNIQUE INDEX pgr_mv_dimension_idx ON public.pgr_mv_dimension USING btree (tenantid, dimension, dim_value);



CREATE UNIQUE INDEX pgr_mv_dimension_tenantid_dimension_dim_value_idx ON public.pgr_mv_dimension USING btree (tenantid, dimension, dim_value);



CREATE UNIQUE INDEX pgr_mv_kpi_tenantid_idx ON public.pgr_mv_kpi USING btree (tenantid);



CREATE UNIQUE INDEX pgr_mv_monthly_source_idx ON public.pgr_mv_monthly_source USING btree (tenantid, month_date, source);



CREATE UNIQUE INDEX pgr_mv_monthly_source_tenantid_month_date_source_idx ON public.pgr_mv_monthly_source USING btree (tenantid, month_date, source);



CREATE UNIQUE INDEX pgr_mv_monthly_tenantid_month_date_idx ON public.pgr_mv_monthly USING btree (tenantid, month_date);



CREATE UNIQUE INDEX pgr_mv_monthly_tenantid_month_idx ON public.pgr_mv_monthly USING btree (tenantid, month_date);




