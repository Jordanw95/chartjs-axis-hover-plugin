import { getClosestLabelIndex } from '../index';
import { Scale } from 'chart.js';

test('Get Closest Label Index', () => {
    const relevantScale = {getValueForPixel : (num: number): number => num / 100} as Scale;
    const labels = ['a' , 'b', 'c', 'd', 'e', 'f', 'g']
    expect(getClosestLabelIndex(200, relevantScale, labels)).toBe(2);
  });