"use strict";
function minuteOfDay(time, channel) {
    const match = String(time ?? "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60) return Number(match[1]) * 60 + Number(match[2]);
    // dasWetter channels denote clock hours, not offsets from now.
    return (Number(channel) % 24) * 60;
}
module.exports = { minuteOfDay };
