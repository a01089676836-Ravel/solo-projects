import json
from pathlib import Path
import tempfile
import unittest

import pipeline as p


def event(activity, day, seq):
    return {"activity":activity,"ts":day*p.DAY,"seq":seq,"source_order":seq}


def simple_case(days=(0,2,3,10)):
    return [event(a,d,i) for i,(a,d) in enumerate(zip((p.CREATE,p.GR,p.IR,p.CLEAR),days))]


class AnalysisTests(unittest.TestCase):
    def test_timezone_equivalence_and_naive_refusal(self):
        self.assertEqual(p.timestamp('2018-01-01T09:00:00+09:00'),p.timestamp('2018-01-01T00:00:00Z'))
        with self.assertRaises(ValueError):p.timestamp('2018-01-01T00:00:00')

    def test_percentiles_small_and_empty(self):
        self.assertEqual(p.percentile([0,10],.9),9)
        self.assertEqual(p.percentile([7],.5),7)
        self.assertIsNone(p.percentile([],.5))

    def test_valid_anchors_and_interval_partition(self):
        case,reasons=p.assess_case(simple_case())
        self.assertFalse(reasons)
        self.assertEqual(case['cycle_days'],10)
        self.assertEqual(sum((b['ts']-a['ts'])/p.DAY for a,b in zip(case['events'],case['events'][1:])),10)

    def test_partial_case_not_treated_as_zero_cycle(self):
        case,reasons=p.assess_case(simple_case()[:-1])
        self.assertIsNone(case)
        self.assertIn('Clear Invoice:count=0',reasons)

    def test_legitimate_split_receipt_is_excluded_not_deduplicated(self):
        events=simple_case();events.insert(2,event(p.GR,2.5,5))
        case,reasons=p.assess_case(events)
        self.assertIsNone(case)
        self.assertIn('Record Goods Receipt:count=2',reasons)

    def test_cancelled_case_and_invalid_anchor_order(self):
        case,reasons=p.assess_case(simple_case()+[event('Cancel Goods Receipt',11,4)])
        self.assertIsNone(case);self.assertIn('cancellation_or_deletion',reasons)
        self.assertIsNone(p.assess_case(simple_case((5,2,3,10)))[0])

    def test_outside_window_not_included_in_cycle_edges(self):
        case,_=p.assess_case([event('Earlier',-1,5)]+simple_case()+[event('Later',12,6)])
        self.assertEqual(len(case['events']),4)
        self.assertEqual(case['cycle_days'],10)

    def test_simultaneous_anchors_allow_zero_but_no_negative(self):
        case,_=p.assess_case(simple_case((0,0,0,0)))
        self.assertEqual(case['cycle_days'],0)

    def test_scenario_zero_identity_and_only_selected_edge_changes(self):
        case,_=p.assess_case(simple_case())
        out=p.scenario([case],p.IR,p.CLEAR,0)
        self.assertEqual(out['baseline'],out['counterfactual'])
        out=p.scenario([case],p.IR,p.CLEAR,.2)
        self.assertAlmostEqual(out['counterfactual']['median_days'],8.6)
        self.assertAlmostEqual(out['median_reduction_days'],1.4)

    def test_scenario_absent_edge_and_bounds(self):
        case,_=p.assess_case(simple_case())
        self.assertEqual(p.scenario([case],'absent',p.CLEAR,.5)['affected_cases'],0)
        for r in (-.1,1.1,float('nan')):
            with self.assertRaises(ValueError):p.scenario([case],p.IR,p.CLEAR,r)

    def test_stream_parser_namespace_and_original_order(self):
        xml='''<log xmlns="http://www.xes-standard.org/"><trace><string key="concept:name" value="A"/><string key="Item Category" value="type"/><event><string key="concept:name" value="late"/><date key="time:timestamp" value="2018-01-02T00:00:00Z"/></event><event><string key="concept:name" value="early"/><date key="time:timestamp" value="2018-01-01T00:00:00Z"/></event></trace><trace><string key="concept:name" value="B"/><event><string key="concept:name" value="same"/><date key="time:timestamp" value="2018-01-01T00:00:00Z"/></event></trace></log>'''
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fixture.xes';path.write_text(xml,encoding='utf-8')
            traces=list(p.read_traces(path))
        self.assertEqual(len(traces),2)
        self.assertEqual(traces[0][0]['concept:name'],'A')
        self.assertEqual([e['activity'] for e in traces[0][1]],['late','early'])
        self.assertEqual(traces[1][1][0]['source_order'],0)

    def test_checksum_mismatch_does_not_create_database(self):
        with tempfile.TemporaryDirectory() as folder:
            raw=Path(folder)/'data.xes';raw.write_text('tampered')
            db=Path(folder)/'events.sqlite'
            meta={'files':[{'name':'BPI_Challenge_2019.xes','size':8,'computed_md5':'wrong'}]}
            with self.assertRaises(ValueError):p.ingest(raw,db,meta)
            self.assertFalse(db.exists());self.assertFalse(db.with_suffix('.building').exists())


if __name__=='__main__':unittest.main()
