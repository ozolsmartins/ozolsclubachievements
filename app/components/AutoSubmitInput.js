'use client';

// An input that auto-submits its enclosing form on change (useful for date/month inputs)
export default function AutoSubmitInput({ name, type = 'text', defaultValue, max, className = '', placeholder }) {
  const onChange = (e) => {
    const form = e.currentTarget.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else if (form) {
      form.submit();
    }
  };

  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue}
      max={max}
      placeholder={placeholder}
      className={className}
      onChange={onChange}
    />
  );
}
