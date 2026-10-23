import { describe, it, expect } from 'vitest';
import { getLayoutedElements } from './dagLayout';
import { Node, Edge } from 'reactflow';

describe('dagLayout', () => {
  it('layouts 4 linear nodes in LR and TB', () => {
    const nodes: Node[] = [
      { id: '1', position: { x: 0, y: 0 }, data: { label: 'http-req' } },
      { id: '2', position: { x: 0, y: 0 }, data: { label: 'Container' } },
      { id: '3', position: { x: 0, y: 0 }, data: { label: 'HTTP Req' } },
      { id: '4', position: { x: 0, y: 0 }, data: { label: 'load-bigquery' } },
    ];
    const edges: Edge[] = [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
      { id: 'e3-4', source: '3', target: '4' },
    ];

    const lr = getLayoutedElements(nodes, edges, 'LR');
    expect(lr.nodes[0].position.y).toBe(lr.nodes[1].position.y);
    expect(lr.nodes[1].position.y).toBe(lr.nodes[2].position.y);
    expect(lr.nodes[2].position.y).toBe(lr.nodes[3].position.y);

    const tb = getLayoutedElements(nodes, edges, 'TB');
    expect(tb.nodes[0].position.x).toBe(tb.nodes[1].position.x);
    expect(tb.nodes[1].position.x).toBe(tb.nodes[2].position.x);
    expect(tb.nodes[2].position.x).toBe(tb.nodes[3].position.x);
  });

  it('layouts branching diamond graph symmetrically', () => {
    const nodes: Node[] = [
      { id: '1', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      { id: '2', position: { x: 0, y: 0 }, data: { label: 'Branch A' } },
      { id: '3', position: { x: 0, y: 0 }, data: { label: 'Branch B' } },
      { id: '4', position: { x: 0, y: 0 }, data: { label: 'End' } },
    ];
    const edges: Edge[] = [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e1-3', source: '1', target: '3' },
      { id: 'e2-4', source: '2', target: '4' },
      { id: 'e3-4', source: '3', target: '4' },
    ];

    const lr = getLayoutedElements(nodes, edges, 'LR');
    // Start and End should be on the centerline
    expect(lr.nodes[0].position.y).toBe(lr.nodes[3].position.y);
    // Branch A and B should have different Y positions
    expect(lr.nodes[1].position.y).not.toBe(lr.nodes[2].position.y);
  });

  it('aligns handle centers horizontally for nodes with different heights (ETL pattern)', () => {
    const nodes: Node[] = [
      { id: 'p1', position: { x: 0, y: 0 }, data: { type: 'container', label: 'Extract GCS', container: { image: 'google/cloud-sdk:slim' } } },
      { id: 'p2', position: { x: 0, y: 0 }, data: { type: 'script', label: 'Transform' } },
      { id: 'p3', position: { x: 0, y: 0 }, data: { type: 'container', label: 'Load BigQuery', container: { image: 'google/cloud-sdk:slim' } } },
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'p1', target: 'p2' },
      { id: 'e2', source: 'p2', target: 'p3' },
    ];

    const lr = getLayoutedElements(nodes, edges, 'LR');
    const handleY0 = lr.nodes[0].position.y + 74 / 2;
    const handleY1 = lr.nodes[1].position.y + 48 / 2;
    const handleY2 = lr.nodes[2].position.y + 74 / 2;

    expect(handleY0).toBe(handleY1);
    expect(handleY1).toBe(handleY2);
  });
});
