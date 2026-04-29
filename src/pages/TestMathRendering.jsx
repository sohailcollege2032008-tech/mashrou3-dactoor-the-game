import React from 'react'
import MathText from '../components/common/MathText'

export default function TestMathRendering() {
  const questionText = `(دورتان ٢٠١٧) تحرك جسم في خط مستقيم بسرعة منتظمة تحت تأثير القوتين: <math><msub><mover><mi>ق</mi><mo>→</mo></mover><mn>١</mn></msub><mo>=</mo><mn>١٢</mn><mover><mi>س</mi><mo>→</mo></mover><mo>-</mo><mn>٣</mn><mover><mi>ص</mi><mo>→</mo></mover><mo>+</mo><mn>٤</mn><mover><mi>ع</mi><mo>→</mo></mover></math>، <math><msub><mover><mi>ق</mi><mo>→</mo></mover><mn>٢</mn></msub><mo>=</mo><mn>٦</mn><mover><mi>س</mi><mo>→</mo></mover><mo>+</mo><mi>ب</mi><mover><mi>ص</mi><mo>→</mo></mover><mo>-</mo><mi>د</mi><mover><mi>ع</mi><mo>→</mo></mover></math> فإن: <math><mi>ب</mi><mo>+</mo><mi>د</mi><mo>=</mo><mo>.</mo><mo>.</mo><mo>.</mo><mo>.</mo><mo>.</mo><mo>.</mo><mo>.</mo></math>`

  return (
    <div dir="rtl" style={{
      minHeight: '100vh',
      padding: '40px',
      background: '#F4F1EA',
      color: '#1a1a1a',
      fontFamily: 'var(--sans), system-ui, sans-serif'
    }}>
      <h1 style={{ marginBottom: 30, fontSize: 20 }}>اختبار تعرض المعادلات</h1>

      <div style={{
        border: '1px solid #ccc',
        padding: '20px',
        background: 'white',
        borderRadius: 8,
        marginBottom: 30
      }}>
        <h2 style={{ fontSize: 16, marginBottom: 15 }}>السؤال:</h2>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <MathText text={questionText} dir="rtl" />
        </div>
      </div>

      <div style={{
        border: '1px solid #999',
        padding: '20px',
        background: '#f9f9f9',
        borderRadius: 8,
      }}>
        <h2 style={{ fontSize: 16, marginBottom: 15 }}>التحقق:</h2>
        <ul style={{ fontSize: 13, lineHeight: 2 }}>
          <li>✓ هل ق₁ يظهر <strong>قبل</strong> علامة = ؟</li>
          <li>✓ هل ق₂ يظهر <strong>قبل</strong> علامة = ؟</li>
          <li>✓ هل الأسهم تظهر بشكل صحيح بعد المتغيرات؟</li>
          <li>✓ هل المعادلة مقروءة بشكل منطقي؟</li>
        </ul>
      </div>
    </div>
  )
}
