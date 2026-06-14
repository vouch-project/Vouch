import { SerialQueue } from './serial-queue';

describe('SerialQueue', () => {
  it('runs tasks for a key serially in FIFO order', async () => {
    const queue = new SerialQueue();
    const order: number[] = [];
    const task = (n: number, delayMs: number) => () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          order.push(n);
          resolve();
        }, delayMs),
      );

    // First task is slowest; serial execution must still finish it first.
    queue.enqueue('k', task(1, 30));
    queue.enqueue('k', task(2, 10));
    queue.enqueue('k', task(3, 0));

    await queue.idle('k');

    expect(order).toEqual([1, 2, 3]);
  });

  it('keeps processing later tasks after an earlier task rejects', async () => {
    const queue = new SerialQueue();
    const second = jest.fn().mockResolvedValue(undefined);

    queue.enqueue('k', () => Promise.reject(new Error('boom')));
    queue.enqueue('k', second);

    await queue.idle('k');

    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reports task rejections via the onError callback', async () => {
    const onError = jest.fn();
    const queue = new SerialQueue(onError);
    const err = new Error('boom');

    queue.enqueue('k', () => Promise.reject(err));

    await queue.idle('k');

    expect(onError).toHaveBeenCalledWith('k', err);
  });

  it('isolates keys so one queue does not block another', async () => {
    const queue = new SerialQueue();
    const order: string[] = [];

    queue.enqueue('a', () => Promise.reject(new Error('a fails')));
    queue.enqueue('b', () => {
      order.push('b ran');
      return Promise.resolve();
    });

    await Promise.all([queue.idle('a'), queue.idle('b')]);

    expect(order).toEqual(['b ran']);
  });

  it('idle() resolves immediately for an unknown key', async () => {
    const queue = new SerialQueue();
    await expect(queue.idle('never-used')).resolves.toBeUndefined();
  });
});
