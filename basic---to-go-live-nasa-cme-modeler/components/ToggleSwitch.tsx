import React from 'react';

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string; // ADDED THIS LINE
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, checked, onChange, id }) => { // ADDED id TO PROPS
  const bgColor = checked ? 'bg-neutral-600' : 'bg-neutral-800';
  const knobPosition = checked ? 'translate-x-5' : 'translate-x-0';

  return (
    <label htmlFor={id || label} className="flex items-center justify-between cursor-pointer"> {/* Use id if provided, else label */}
      <span className={`text-sm text-neutral-300`}>{label}</span>
      <div className="relative">
        <input 
          type="checkbox" 
          id={id || label} // Use id if provided, else label
          className="sr-only" 
          checked={checked} 
          onChange={(e) => onChange(e.target.checked)} 
        />
        <div className={`block w-10 h-5 rounded-full transition-colors ${bgColor}`}></div>
        <div className={`dot absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform ${knobPosition}`}></div>
      </div>
    </label>
  );
};

export default ToggleSwitch;