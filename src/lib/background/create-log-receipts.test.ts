import { describe, expect, it } from 'vitest';
import type { BackgroundToTab, PageLog } from '@/lib/types';
import { createLogReceipts } from './create-log-receipts';

const log = { level: 'info', message: 'recording ended (command) after 3 chunks' } as const;

function setup() {
  const written: (PageLog & { at?: number | undefined; tabId: number })[] = [];
  const acks: BackgroundToTab[] = [];
  const receipts = createLogReceipts((line, tabId) => written.push({ ...line, tabId }));
  const receive = (tabId: number, message: Parameters<typeof receipts.receive>[1]) =>
    receipts.receive(tabId, message, (ack) => acks.push(ack));
  return { receipts, written, acks, receive };
}

describe('createLogReceipts', () => {
  it('writes a line under the time the bridge got it, and acks it', () => {
    const { written, acks, receive } = setup();
    receive(3, { log, at: 900, receipt: { bridge: 'b1', seq: 1 } });
    expect(written).toEqual([{ ...log, at: 900, tabId: 3 }]);
    expect(acks).toEqual([{ type: 'logAck', seq: 1 }]);
  });

  it('writes a line sent again once, and acks it every time', () => {
    const { written, acks, receive } = setup();
    for (const seq of [1, 2, 1, 2, 3]) receive(3, { log, at: seq, receipt: { bridge: 'b1', seq } });
    expect(written.map((line) => line.at)).toEqual([1, 2, 3]);
    expect(acks.map((ack) => (ack.type === 'logAck' ? ack.seq : null))).toEqual([1, 2, 1, 2, 3]);
  });

  it('writes a line sent again after later ones came, as one lost with a dropped Port is', () => {
    const { written, receive } = setup();
    for (const seq of [2, 3, 1, 3]) receive(3, { log, at: seq, receipt: { bridge: 'b1', seq } });
    expect(written.map((line) => line.at)).toEqual([2, 3, 1]);
  });

  it("counts each tab's bridge on its own: a new bridge in a tab numbers its lines from 1 again", () => {
    const { written, receive } = setup();
    receive(3, { log, at: 1, receipt: { bridge: 'b1', seq: 5 } });
    receive(4, { log, at: 2, receipt: { bridge: 'b2', seq: 1 } });
    receive(3, { log, at: 3, receipt: { bridge: 'b3', seq: 1 } });
    expect(written).toHaveLength(3);
  });

  it('writes a line without a receipt as it comes, and acks nothing', () => {
    const { written, acks, receive } = setup();
    receive(3, { log });
    expect(written).toEqual([{ ...log, tabId: 3 }]);
    expect(acks).toEqual([]);
  });

  it('acks what it receives without anywhere to write it', () => {
    const acks: BackgroundToTab[] = [];
    createLogReceipts(undefined).receive(3, { log, receipt: { bridge: 'b', seq: 1 } }, (ack) =>
      acks.push(ack),
    );
    expect(acks).toEqual([{ type: 'logAck', seq: 1 }]);
  });

  it('remembers so many numbers per tab, forgetting the lowest first', () => {
    const written: number[] = [];
    const receipts = createLogReceipts((line) => written.push(line.at ?? 0), 2);
    for (const seq of [1, 2, 3, 3, 1]) {
      receipts.receive(3, { log, at: seq, receipt: { bridge: 'b1', seq } }, () => undefined);
    }
    // 1 was forgotten when 3 came: written again, the rare cost of a bound.
    expect(written).toEqual([1, 2, 3, 1]);
  });
});
