import os
import joblib
import numpy as np
from datetime import datetime
from typing import Dict, Any
import logging

import xgboost as xgb
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)


class CreditScoreService:
    def __init__(self):
        self.model = None
        self.scaler = None
        self.model_path = os.getenv("MODEL_PATH", "./models")
        self.load_model()

    def load_model(self):
        """Load the trained model and scaler"""
        try:
            model_file = os.path.join(self.model_path, "credit_model.joblib")
            scaler_file = os.path.join(self.model_path, "scaler.joblib")
            
            if os.path.exists(model_file) and os.path.exists(scaler_file):
                self.model = joblib.load(model_file)
                self.scaler = joblib.load(scaler_file)
                logger.info("Model and scaler loaded successfully")
            else:
                logger.warning("Model files not found. Using rule-based scoring.")
                self._initialize_default_model()
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            self._initialize_default_model()

    def _initialize_default_model(self):
        """Initialize a simple rule-based model as fallback"""
        logger.info("Initializing default rule-based model")
        self.model = None
        self.scaler = StandardScaler()

    def is_model_loaded(self) -> bool:
        """Check if ML model is loaded"""
        return self.model is not None

    def get_timestamp(self) -> str:
        """Get current timestamp"""
        return datetime.utcnow().isoformat()

    def calculate_score(self, blockchain_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculate credit score based on blockchain data
        
        Args:
            blockchain_data: Dictionary containing wallet metrics
            
        Returns:
            Dictionary with score, breakdown, risk level, and confidence
        """
        if self.model is not None:
            return self._ml_based_score(blockchain_data)
        else:
            return self._rule_based_score(blockchain_data)

    def _ml_based_score(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate score using ML model"""
        features = self._extract_features(data)
        features_scaled = self.scaler.transform([features])
        
        # Predict probability of being a good borrower
        prob = self.model.predict_proba(features_scaled)[0][1]
        
        # Convert to credit score (300-850 range)
        credit_score = 300 + (prob * 550)
        
        return {
            "score": round(credit_score, 2),
            "breakdown": self._calculate_breakdown(data),
            "risk_level": self._determine_risk_level(credit_score),
            "confidence": round(prob, 3)
        }

    def _rule_based_score(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate score using rule-based approach"""
        score = 500  # Base score
        breakdown = {}
        
        # Transaction history (max +100 points)
        tx_count = data.get("transaction_count", 0)
        tx_score = min(tx_count / 100 * 100, 100)
        score += tx_score
        breakdown["transaction_history"] = tx_score
        
        # Account age (max +80 points)
        account_age_days = data.get("account_age_days", 0)
        age_score = min(account_age_days / 365 * 80, 80)
        score += age_score
        breakdown["account_age"] = age_score
        
        # Average balance (max +100 points)
        avg_balance = data.get("avg_balance_eth", 0)
        balance_score = min(avg_balance * 10, 100)
        score += balance_score
        breakdown["balance_history"] = balance_score
        
        # DeFi interaction (max +70 points)
        defi_protocols = data.get("defi_protocols_used", 0)
        defi_score = min(defi_protocols * 10, 70)
        score += defi_score
        breakdown["defi_activity"] = defi_score
        
        # Previous loans (max +100 points if good history)
        successful_loans = data.get("successful_loans", 0)
        defaulted_loans = data.get("defaulted_loans", 0)
        
        if defaulted_loans > 0:
            loan_score = -50 * defaulted_loans
        else:
            loan_score = min(successful_loans * 20, 100)
        
        score += loan_score
        breakdown["loan_history"] = max(loan_score, 0)
        
        # Ensure score is within range
        score = max(300, min(850, score))
        
        return {
            "score": round(score, 2),
            "breakdown": breakdown,
            "risk_level": self._determine_risk_level(score),
            "confidence": 0.75  # Lower confidence for rule-based
        }

    def _extract_features(self, data: Dict[str, Any]) -> list:
        """Extract feature vector from blockchain data"""
        return [
            data.get("transaction_count", 0),
            data.get("account_age_days", 0),
            data.get("avg_balance_eth", 0),
            data.get("max_balance_eth", 0),
            data.get("total_volume_eth", 0),
            data.get("defi_protocols_used", 0),
            data.get("nft_count", 0),
            data.get("successful_loans", 0),
            data.get("defaulted_loans", 0),
            data.get("gas_spent_eth", 0),
        ]

    def _calculate_breakdown(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Calculate score breakdown by category"""
        return {
            "transaction_history": 0.20,
            "account_age": 0.15,
            "balance_history": 0.25,
            "defi_activity": 0.20,
            "loan_history": 0.20
        }

    def _determine_risk_level(self, score: float) -> str:
        """Determine risk level based on credit score"""
        if score >= 750:
            return "low"
        elif score >= 650:
            return "medium"
        elif score >= 550:
            return "medium-high"
        else:
            return "high"

    async def train_model(self) -> Dict[str, Any]:
        """Train/retrain the ML model"""
        # TODO: Implement model training logic
        # This would fetch historical data and train the XGBoost model
        return {
            "status": "success",
            "message": "Model training not yet implemented"
        }
