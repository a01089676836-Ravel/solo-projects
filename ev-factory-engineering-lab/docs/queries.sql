-- Run against output/factory.sqlite. All data is synthetic.
-- SDF: production-lot quality trace.
-- Daily output and defect rate by product variant.
SELECT day, variant, COUNT(*) AS total,
       SUM(defect) AS first_pass_failures,
       ROUND(1.0-AVG(defect), 4) AS first_pass_yield
FROM units GROUP BY day,variant ORDER BY day,variant;

-- Engineering: distinguish processing from waiting.
-- Compare queue delay and processing time by station; they are different measures.
SELECT station, COUNT(*) AS visits,
       ROUND(AVG(end_s-start_s),2) AS mean_cycle_s,
       ROUND(AVG(wait_s),2) AS mean_queue_s
FROM events GROUP BY station;

-- Unit-level traceability. Change this example ID when exploring.
-- Show the complete station timeline for each unit to inspect route evidence.
SELECT u.unit_id,u.variant,u.defect,e.station,e.cell,e.start_s,e.end_s,e.wait_s
FROM units u JOIN events e USING(unit_id)
WHERE u.unit_id='D25-U0001' ORDER BY e.start_s;
