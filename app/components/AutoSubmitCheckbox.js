'use client';

// Checkbox that auto-submits its enclosing form on change
export default function AutoSubmitCheckbox({ id, name, defaultChecked = false, value = '1', className = '', label }) {
  const onChange = (e) => {
    const form = e.currentTarget.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else if (form) {
      // Fallback for older browsers
      form.submit();
    }
  };

  return (
    <div className="flex items-center gap-2 h-10">
      <input
        type="checkbox"
        id={id}
        name={name}
        value={value}
        defaultChecked={!!defaultChecked}
        className={className || 'h-4 w-4'}
        onChange={onChange}
      />
      {label && (
        <label htmlFor={id} className="text-sm">{label}</label>
      )}
    </div>
  );
}
