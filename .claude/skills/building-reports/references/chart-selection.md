# Chart selection

Pick by the question, then check the data shape. If a dedicated visualisation skill is loaded in
the session, use it for colour, accessibility and layout; this file only chooses the form.

| Question | Form | Notes |
|---|---|---|
| How does one measure move over time | Line | One line per series; at most 5 series |
| How do parts of a total move over time | Stacked bar (counts, money) or stacked area | Order series by size; keep "other" last |
| How does the mix change over time | 100% stacked bar | Only when the total is shown elsewhere |
| Compare categories at one point | Horizontal bar, sorted | Not a pie above 4 slices |
| Distribution of a value | Histogram or box | Show n |
| Relationship between two measures | Scatter | Label outliers |
| Progress against a target | Bullet bar or a single number with delta | Not a gauge |
| A single headline number | Stat tile with period delta and sparkline | State the period |
| Cohort behaviour | Line per cohort by periods-since-start, or heatmap | Never by calendar month |
| Funnel | Horizontal bars in stage order with conversion labels | Not a funnel-shaped graphic |

Rules:

- Lead with the measure the decision depends on. Offer a toggle for the second one.
- Time on the x axis runs left to right with every period present (dense spine).
- Label the partial period.
- One y axis unless the two measures share a scale.
- A table accompanies every chart so the numbers can be read and exported.
- If the chart needs a legend of more than 8 entries, change the question or bucket into "other".
