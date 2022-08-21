import { Chart, ChartEvent, Scale, Plugin, FontSpec } from 'chart.js';

/*
  Plugin to create tooltips on hover of graph. See axisHoverPlugin for overall flow.
*/

type StyleOpts = {
  font: string;
  minTooltipWidth: number;
  maxTooltipWidth: number;
  caretSize: number;
  xScaleAdjustment: number;
  yScaleAdjustment: number;
  xTextAdjustment: number;
  yTextAdjustment: number;
  tooltipBackgroundColor: string;
  fontColor: string;
  boxPadding: number;
  tooltipBackgroundRadius: number;
  tooltipDistanceFromZeroHorizontal: number;
  tooltipDistanceFromZeroVertical: number;
};

type DrawingCoordinates = {
  startingX: number;
  startingY: number;
  textX: number;
  textY: number;
};

type AxisHoverPlugin = {
  hoveredIndex?: number;
  isVertical?: boolean;
  label?: string;
  draw?: boolean;
  styleOpts?: StyleOpts;
};

interface ChartWithPlugin extends Chart {
  axisHoverPlugin?: AxisHoverPlugin;
}

// There does not appear to be an appropriate type for the sent object in chart js, closest seems to
// be arguments sent to on hover event, but there is no defined type for this. Hence type defined here.
type BeforeEventArgs = {
  event: ChartEvent;
  replay: boolean;
  cancelable: boolean;
};

export const getClosestLabelIndex = (
  relevantHoverPixel: number,
  relevantScale: Scale,
  fullLabels: string[]
): number => {
  // Can assume this method will return a number here as have done relevant checks in checkValidEvent
  const hoverValue = relevantScale.getValueForPixel(relevantHoverPixel) as number;
  // Values returned from getValueForPixel can be negative or higher than max index
  // of labels (based on hovering on outside edge of out catagory scales). So we return
  // closest real index.
  const maxIndex = fullLabels.length - 1;
  const index = hoverValue > maxIndex ? maxIndex : hoverValue < 0 ? 0 : hoverValue;
  return index;
};

const checkValidEvent = (
  left: number,
  bottom: number,
  event: ChartEvent,
  scales: Chart['scales'],
  isVertical: boolean
): boolean => {
  if (event.y === null || event.x === null) {
    return false;
  }
  const withinCanvas = event.y < bottom && event.y > 0 && event.x > 0 && event.x < left;
  // Confirm that event is on the actual scale and not on graph area. On horizontal graphs we also acount
  // for gap between scale and actual bars.
  const onAxisTitles = isVertical
    ? scales.y.getPixelForValue(0) + 5 < event.y
    : scales.x.getPixelForValue(0) - 20 > event.x;
  return withinCanvas && onAxisTitles;
};

const drawCaret = (
  ctx: CanvasRenderingContext2D,
  drawingCoordinates: DrawingCoordinates,
  radius: number,
  rotate: number,
  styleOpts: StyleOpts
): void => {
  const { startingX, startingY } = drawingCoordinates;
  ctx.beginPath();
  // Three sides on a triangle
  const sides = 3;
  const a = (Math.PI * 2) / sides;
  for (let i = 0; i < sides; i++) {
    ctx.lineTo(
      startingX + radius * Math.cos(a * i + rotate),
      startingY + radius * Math.sin(a * i + rotate)
    );
  }
  ctx.closePath();
  ctx.fillStyle = styleOpts.tooltipBackgroundColor;
  ctx.fill();
  ctx.stroke();
};

const getLines = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  styleOpts: StyleOpts
): string[] => {
  // This method returns the label split into lines that fit within the max
  // width that was supplied to it.
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    ctx.font = styleOpts.font;
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
};

const drawTextLine = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textBasline: 'middle' | 'top',
  styleOpts: StyleOpts
): void => {
  ctx.save();
  ctx.font = styleOpts.font;
  ctx.fillStyle = styleOpts.fontColor;
  ctx.textBaseline = textBasline;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
  ctx.restore();
};

const drawTooltipBackground = (
  ctx: CanvasRenderingContext2D,
  drawingCoordinates: DrawingCoordinates,
  w: number,
  h: number,
  multiLine: boolean,
  styleOpts: StyleOpts,
  isVertical: boolean
): void => {
  const { textY, textX } = drawingCoordinates;
  let radius = styleOpts.tooltipBackgroundRadius;

  const textWidth = w + styleOpts.boxPadding;
  const textHeight = h + styleOpts.boxPadding;
  // The coordinates x and y here represent the top corner of the tooltip background
  const initialCornerX = textX - textWidth / 2;
  const y = multiLine ? textY - styleOpts.boxPadding / 2 : textY - textHeight / 2;

  // if it is horizontal, we want to draw from startinX + standard distance and want to adjust
  // width by difference between inital x and this new x
  const x = isVertical
    ? initialCornerX
    : drawingCoordinates.startingX - styleOpts.tooltipDistanceFromZeroVertical;
  const width = isVertical ? textWidth : textWidth + (initialCornerX - x);
  // if it is vertical we just want to draw with hieght  of the distance from y + initial height and
  // startingY + standardDistance
  const height = isVertical
    ? drawingCoordinates.startingY + styleOpts.tooltipDistanceFromZeroVertical - y
    : textHeight;
  radius = width < 2 * radius ? width / 2 : height < 2 * radius ? height / 2 : radius;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = styleOpts.tooltipBackgroundColor;
  ctx.fill();
};

const drawTooltip = (
  ctx: ChartWithPlugin['ctx'],
  label: string,
  drawingCoordinates: DrawingCoordinates,
  isVertical: boolean,
  chartArea: ChartWithPlugin['chartArea'],
  styleOpts: StyleOpts
): void => {
  const { right } = chartArea;
  const { textX, textY } = drawingCoordinates;
  // Need to get the distance from x point to closest edge to calculate how wide text box can be
  // without adjusting position. If vertical graph, we want the smallest distance from the
  // closest edge. If horizontal graph we only want difference from left edge.
  const minDistanceToEdge = isVertical
    ? right - textX < textX
      ? right - textX
      : 0 - textX
    : right - textX + styleOpts.xScaleAdjustment;
  // Setting and applying min / max sizes for tooltip boxes if necessary. Else let width be decided
  // distance from edge if graph (only want to restrict minTooltipWidth on vertical as plenty of room
  // in x on horizontal graphs).
  const maxTextBoxWidth =
    Math.abs(minDistanceToEdge) < styleOpts.minTooltipWidth && isVertical
      ? styleOpts.minTooltipWidth
      : Math.abs(minDistanceToEdge) > styleOpts.maxTooltipWidth
      ? styleOpts.maxTooltipWidth
      : Math.abs(minDistanceToEdge);
  // if the text would fit on one line, we measure the text directly, otherwise we assume text is same width
  // as maxTextWidth that was used in the get lines function
  ctx.font = styleOpts.font;
  const textWidth =
    ctx.measureText(label).width < maxTextBoxWidth ? ctx.measureText(label).width : maxTextBoxWidth;
  const textLines = getLines(ctx, label, maxTextBoxWidth, styleOpts);
  // If vertical and text would have overflown, we need to adjust the x position of text.
  // let adjustedX = textX;
  // this will only be a problem where we have used the minTooltip width and the tool tip is
  // is close enough that one side of it reaches the edge (divide by two as text is centered).
  // We also need to take into account padding so that this does not overlap edges too.
  if (Math.abs(minDistanceToEdge) < textWidth / 2 + styleOpts.boxPadding * 2) {
    // If it close enough that it would overlap, adjust according to textWidth and distance to edge
    const xCorrection = (textWidth - Math.abs(minDistanceToEdge)) / 2;
    // Direction it should be moved is dictated by if closest to left side or right side (negative or positive).
    drawingCoordinates.textX = minDistanceToEdge < 0 ? textX + xCorrection : textX - xCorrection;
  }
  const linesHeight = 15;
  const textHeight = textLines.length * linesHeight;
  if (textLines.length === 1) {
    // If only one line, we can just draw one centred line
    drawingCoordinates.textX = isVertical
      ? drawingCoordinates.textX
      : drawingCoordinates.textX + textWidth / 2;
    drawTooltipBackground(
      ctx,
      drawingCoordinates,
      textWidth,
      textHeight,
      false,
      styleOpts,
      isVertical
    );
    drawTextLine(
      ctx,
      textLines[0],
      drawingCoordinates.textX,
      drawingCoordinates.textY,
      'middle',
      styleOpts
    );
  } else {
    // If plotting vertically need to account for the fact lines are now drawn from 'top' in the Y.
    // If horizontal want to shift the text up by half it's height, so it alligns by the middle in the Y.
    // In the X, we want to begin writing lines from the middle, so add half the text width to X.
    drawingCoordinates.textY = isVertical
      ? textY - (textHeight - linesHeight)
      : textY - textHeight / 2;
    drawingCoordinates.textX = isVertical
      ? drawingCoordinates.textX
      : drawingCoordinates.textX + textWidth / 2;
    drawTooltipBackground(
      ctx,
      drawingCoordinates,
      textWidth,
      textHeight,
      true,
      styleOpts,
      isVertical
    );
    textLines.forEach((line, i) => {
      drawTextLine(
        ctx,
        line,
        drawingCoordinates.textX,
        drawingCoordinates.textY + i * linesHeight,
        'top',
        styleOpts
      );
    });
  }
};

const drawLabel = (
  chart: ChartWithPlugin,
  index: number,
  isVertical: boolean,
  label: string,
  styleOpts: StyleOpts
) => {
  const { ctx, scales, chartArea } = chart;
  // startingX and startingY allign to the 0 point on the axis, for each scale value, for horizontal and
  // vertical graphs. Adjustments used to allign caret drawing point.
  const startingX = isVertical
    ? scales.x.getPixelForValue(index)
    : scales.x.getPixelForValue(0) + styleOpts.xScaleAdjustment;
  const startingY = isVertical
    ? scales.y.getPixelForValue(0) + styleOpts.yScaleAdjustment
    : scales.y.getPixelForValue(index);
  // For horizontal graphs, we want text to begin to the right of the scale and inline with Y scale index
  // in vertical graphs we want data inline with X scale index and slightly above the gray axis x line.
  const textX = isVertical ? startingX : startingX + styleOpts.xTextAdjustment;
  const textY = isVertical ? startingY + styleOpts.yTextAdjustment : startingY;
  const drawingCoordinates = {
    startingX,
    startingY,
    textX,
    textY
  };
  // Rotate caret needs to rotate to allign with appropraite axis
  const caretAngle = isVertical ? Math.PI * 2.5 : Math.PI;
  drawCaret(ctx, drawingCoordinates, styleOpts.caretSize, caretAngle, styleOpts);
  drawTooltip(ctx, label, drawingCoordinates, isVertical, chartArea, styleOpts);
  ctx.save();
};

/*
  Axis hover plugin logical flow (as I understand it):

  1) Set initial plugin options. This event is only triggered when the chart is initially rendered.
  The style options are initialised and the plugin object is initialised with default values and draw
  set to false.

  2) When an event is triggered on graph, the before event of the plugin will be triggered.
  Can then check it is a valid event and pull out the details of the event for the tooltip.
  Properties are updated for the plugin and the chart is redrawn,
  so that the following afterDatasetDraw event is triggered.
  If it is am invalid event, we want to ensure the graph is still redrawn, but without tooltips,
  so that tooltips disapear.

  3) Drawing stage. Here we draw the tooltips based on the data from the event. Drawing changes
  depending on if it is a vertical or horizontal chart. Standard canvas drawing functions used at this point.
  See notes within draw functions for more detail.

*/

export const axisHoverPlugin = (isVertical: boolean, fullLabels: string[]): Plugin<'bar'> => ({
  id: 'axisHoverPlugin',
  afterInit: (chart: ChartWithPlugin) => {
    // Initially set the plugin options
    chart.axisHoverPlugin = {
      hoveredIndex: 0,
      isVertical: false,
      label: '',
      draw: false,
      styleOpts: {
        font: `800 12px ${(Chart.defaults.font as FontSpec).family}`,
        minTooltipWidth: 140,
        maxTooltipWidth: 240,
        caretSize: 10,
        xScaleAdjustment: -8,
        yScaleAdjustment: -10,
        xTextAdjustment: 10,
        yTextAdjustment: -15,
        tooltipBackgroundColor: "#000",
        fontColor: "#FFF",
        boxPadding: 10,
        tooltipBackgroundRadius: 3,
        tooltipDistanceFromZeroHorizontal: -5,
        tooltipDistanceFromZeroVertical: 5
      }
    };
  },
  beforeEvent(chart: ChartWithPlugin, args: BeforeEventArgs) {
    const event = args.event;
    const { scales, height, width } = chart;
    // We need to handle mouseout, so tooltips disapear when mouse leaves graph
    if (!['mousemove', 'mouseout'].includes(event.type)) {
      return;
    }
    // chart.js function getValueForPixel can possibly return undefined (if number outside of canvas area
    // is passed). Do one check here that event pixel value is within canvas and after can assume that a number
    // is always returned and that pixel value is not null. This removes constant undefined checks everytime
    // function is used.
    const relevantScale = isVertical ? scales.x : scales.y;
    if (!checkValidEvent(width, height, event, scales, isVertical) || event.type === 'mouseout') {
      chart.axisHoverPlugin = { ...chart.axisHoverPlugin, draw: false };
      chart.draw();
      return;
    }
    const relevantHoverPixel = event[isVertical ? 'x' : 'y'] as number;
    const hoveredIndex = getClosestLabelIndex(relevantHoverPixel, relevantScale, fullLabels);
    const fullHoveredLabel = fullLabels[hoveredIndex];
    // We now have full label value, and index where to draw it.
    chart.axisHoverPlugin = {
      ...chart.axisHoverPlugin,
      ...{
        hoveredIndex,
        isVertical,
        label: fullHoveredLabel,
        draw: true
      }
    };
    chart.draw();
  },
  afterDatasetsDraw: (chart: Required<ChartWithPlugin>) => {
    if (!chart.axisHoverPlugin) {
      return;
    }
    const { hoveredIndex, label, draw, styleOpts } =
      chart.axisHoverPlugin as Required<AxisHoverPlugin>;
    // This event also triggered by other events in chart, so need to check properties
    // trigger draw
    if (!draw) {
      return;
    }
    drawLabel(chart, hoveredIndex, isVertical, label, styleOpts);
  }
});

