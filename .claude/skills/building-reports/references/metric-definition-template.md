# Metric definition

One entry per measure. Keep the definitions in one place (a metrics page or a `metrics/` folder)
and have every report cite the entry rather than restate it.

```markdown
## <metric name>

- Question it answers: <one sentence>
- Formula: <numerator> / <denominator>, or <sum of ...>
- Grain: one value per <period> x <dimensions>
- Bucketing column: <column>, business timezone <tz>
- Source objects: <schema.view ...>
- Inclusions: <what counts>
- Exclusions: <what does not, and why>
- Unit and format: <AUD, count, %, one decimal>
- Known lag: <e.g. dishonours settle 2-5 business days after attempt>
- Figure of record: <which system, if a money figure>
- Owner: <role>
- Used by: <reports>
- Changed: <date> <what and why>
```

Rules:

- A rate names both numerator and denominator populations; "rate" alone is not a definition.
- A count names what one unit is (a loan, an application, a customer, an attempt).
- A money measure names its unit in the data and its displayed unit.
- If a parameter filters the data, the entry says whether the denominator is filtered too.
