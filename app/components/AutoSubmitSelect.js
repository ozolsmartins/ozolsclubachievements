'use client';

// A small client component that auto-submits its enclosing form on change.
export default function AutoSubmitSelect({ name, defaultValue, className = '', children }) {
  const onChange = (e) => {
    const form = e.currentTarget.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else if (form) {
      // Fallback
      form.submit();
    }
  };

  return (
    <select name={name} defaultValue={defaultValue} className={className} onChange={onChange}>
      {children}
    </select>
  );
}
