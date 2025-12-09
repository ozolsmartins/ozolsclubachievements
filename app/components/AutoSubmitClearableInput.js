'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

// A text input with an inline clear (X) control.
// When the X is clicked, it clears the input value and auto-submits the enclosing form.
export default function AutoSubmitClearableInput({ name, placeholder, defaultValue = '', className = '' }) {
  const inputRef = useRef(null);
  const [val, setVal] = useState(String(defaultValue || ''));

  // Keep internal state in sync if defaultValue prop changes
  useEffect(() => {
    setVal(String(defaultValue || ''));
  }, [defaultValue]);

  const submitForm = useCallback((el) => {
    const form = el?.closest?.('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }
  }, []);

  const onInput = (e) => {
    setVal(e.currentTarget.value);
  };

  const clearAndSubmit = () => {
    const el = inputRef.current;
    if (!el) return;
    el.value = '';
    setVal('');
    // Ensure the input's value is part of the submission as empty
    // Then auto-submit the form
    submitForm(el);
  };

  const onKeyDownClear = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clearAndSubmit();
    }
  };

  return (
    <div className="relative inline-block">
      <input
        ref={inputRef}
        type="text"
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        onInput={onInput}
        className={`${className} pr-8`}
      />
      {val && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Clear"
          title="Clear"
          onClick={clearAndSubmit}
          onKeyDown={onKeyDownClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer select-none text-gray-500 hover:text-gray-700"
          style={{
            // Avoid global button styling; this is a span styled as a button-like control
            background: 'transparent',
            border: 'none',
            lineHeight: 1,
            fontWeight: 600,
          }}
        >
          ×
        </span>
      )}
    </div>
  );
}
