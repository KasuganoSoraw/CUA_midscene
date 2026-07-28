<template>
  <div class="evidence-placeholder" role="img" aria-label="该步骤没有独立录制截图">
    <svg viewBox="0 0 160 100" aria-hidden="true">
      <rect x="18" y="15" width="124" height="70" rx="10" />
      <circle cx="51" cy="38" r="8" />
      <path d="M30 72 62 48l20 16 18-13 30 21" />
      <path class="slash" d="m25 83 110-66" />
    </svg>
    <strong>该步骤没有独立录制截图</strong>
    <span>这里使用默认占位图，不会借用其他步骤的全局图或局部图。</span>
  </div>
</template>

<style scoped>
.evidence-placeholder {
  display: grid;
  min-height: 240px;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 28px;
  text-align: center;
  color: #78847d;
  background:
    linear-gradient(135deg, #f7f9f7 25%, transparent 25%) -10px 0 / 20px 20px,
    linear-gradient(225deg, #f7f9f7 25%, transparent 25%) -10px 0 / 20px 20px,
    #fbfcfb;
}
svg {
  width: 150px;
  height: 94px;
  margin-bottom: 4px;
  fill: none;
  stroke: #aab5ae;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.slash {
  stroke: #c3a86d;
  stroke-width: 5;
}
strong {
  color: #59675f;
  font-size: 14px;
}
span {
  max-width: 420px;
  font-size: 12px;
  line-height: 1.55;
}
</style>
