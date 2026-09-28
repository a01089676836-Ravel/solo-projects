# Solo Projects

Five independent portfolio projects, organized by purpose. Company names have been removed from the published copies.

| Project | Purpose |
| --- | --- |
| [PCB Defect Detection](pcb-defect-detection/) | Train and evaluate a PCB defect detector using public research data. |
| [AI/DX Roadmap Copilot](ai-dx-roadmap-copilot/) | Prioritize industrial AI and digital transformation initiatives, with human approval boundaries. |
| [Manufacturing Operations Agent](manufacturing-operations-agent/) | Explore grounded anomaly response and maintenance workflows with public or synthetic data. |
| [EV Factory Engineering Lab](ev-factory-engineering-lab/) | Simulate electrification assembly, evaluate defect risk, and compare process scenarios. |
| [Process Bottleneck Analysis](process-bottleneck-analysis/) | Analyze public purchasing event logs and inspect evidence-linked delay scenarios. |

Each folder retains its own README and project files. Large downloadable source data, local databases, caches, and transient artifacts are excluded when the source project's Git ignore rules call for it. The EV lab keeps its small synthetic demonstration artifacts so its dashboard opens directly. Project-specific limitations are described in each README.

The manufacturing agent's full test suite requires the public AI4I source dataset in its ignored `data/raw/` directory. Without that download, 65 of 68 tests pass; the three remaining tests fail because the CSV is absent. See that project's README for its data setup step.
