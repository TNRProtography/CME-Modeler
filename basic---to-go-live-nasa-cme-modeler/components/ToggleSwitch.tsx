import React from 'react';

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, checked, onChange, disabled = false }) => {
  const bgColor = disabled
    ? 'bg-neutral-800/60'
    : checked ? 'bg-neutral-600' : 'bg-neutral-800';
  const knobPosition = checked ? 'translate-x-5' : 'translate-x-0';
  const knobColor = disabled ? 'bg-neutral-500' : 'bg-white';
  const labelColor = disabled ? 'text-neutral-500' : 'text-neutral-300';
  const cursorClass = disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer';

  return (
    <label htmlFor={label} className={`flex items-center justify-between ${cursorClass}`}>
      <span className={`text-sm ${labelColor}`}>{label}</span>
      <div className="relative">
        <input
          type="checkbox"
          id={label}
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => { if (!disabled) onChange(e.target.checked); }}
        />
        <div className={`block w-10 h-5 rounded-full transition-colors ${bgColor}`}></div>
        <div className={`dot absolute left-0.5 top-0.5 ${knobColor} w-4 h-4 rounded-full transition-transform ${knobPosition}`}></div>
      </div>
    </label>
  );
};

export default ToggleSwitch;