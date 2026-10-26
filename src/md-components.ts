import { createComponent, Types } from '@iwsdk/core';
/** A loose task card on the desk stack. */
export const TaskCard = createComponent('TaskCard', { taskId: { type: Types.String, default: '' } });
/** A scheduled block on the wall timeline. */
export const TimelineBlock = createComponent('TimelineBlock', { taskId: { type: Types.String, default: '' } });
