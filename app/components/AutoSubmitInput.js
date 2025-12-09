'use client';

// An input that auto-submits its enclosing form on change (useful for date/month inputs)
// Accepts and forwards any extra props (e.g., lang) to the underlying input without changing functionality
export default function AutoSubmitInput({ name, type = 'text', defaultValue, max, className = '', placeholder, ...rest }) {
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
      {...rest}
    />
  );
}
