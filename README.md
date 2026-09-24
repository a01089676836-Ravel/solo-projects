# Solo Projects

Three independent portfolio projects, organized by purpose. Company names have been removed from the published copies.

| Project | Purpose |
| --- | --- |
| [PCB Defect Detection](pcb-defect-detection/) | Train and evaluate a PCB defect detector using public research data. |
| [AI/DX Roadmap Copilot](ai-dx-roadmap-copilot/) | Prioritize industrial AI and digital transformation initiatives, with human approval boundaries. |
| [Manufacturing Operations Agent](manufacturing-operations-agent/) | Explore grounded anomaly response and maintenance workflows with public or synthetic data. |

Each folder retains its own README and project files. Downloadable datasets, model weights, local runtimes, generated runs, and a redundant archive are excluded according to the source projects' Git ignore rules. The projects are prototypes and do not claim access to confidential company data.

The manufacturing agent's full test suite requires the public AI4I source dataset in its ignored `data/raw/` directory. Without that download, 65 of 68 tests pass; the three remaining tests fail because the CSV is absent. See that project's README for its data setup step.
