import React from 'react';
import './ForecastModal.css';

interface ForecastModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForecastModal: React.FC<ForecastModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose}>
          ×
        </button>
        <iframe
          src="/forecast.html"
          title="West Coast Aurora Forecast"
          className="modal-iframe"
          frameBorder="0"
        />
      </div>
    </div>
  );
};

export default ForecastModal;