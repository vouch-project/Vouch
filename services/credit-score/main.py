from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict
import logging

from services.credit_scoring import CreditScoreService
from services.blockchain_data import BlockchainDataService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Vouch ML Credit Score API",
    description="Machine Learning service for calculating credit scores based on on-chain history",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
credit_score_service = CreditScoreService()
blockchain_service = BlockchainDataService()


class CreditScoreRequest(BaseModel):
    wallet_address: str


class BatchCreditScoreRequest(BaseModel):
    wallet_addresses: List[str]


class CreditScoreResponse(BaseModel):
    wallet_address: str
    credit_score: float
    score_breakdown: Dict[str, float]
    risk_level: str
    confidence: float


@app.get("/")
async def root():
    return {
        "service": "vouch-ml-credit-score",
        "status": "running",
        "version": "0.1.0"
    }


@app.get("/api/ml/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": credit_score_service.is_model_loaded(),
        "timestamp": credit_score_service.get_timestamp()
    }


@app.post("/api/ml/credit-score", response_model=CreditScoreResponse)
async def calculate_credit_score(request: CreditScoreRequest):
    """
    Calculate credit score for a single wallet address
    """
    try:
        logger.info(f"Calculating credit score for {request.wallet_address}")
        
        # Fetch on-chain data
        blockchain_data = await blockchain_service.fetch_wallet_data(request.wallet_address)
        
        # Calculate credit score
        result = credit_score_service.calculate_score(blockchain_data)
        
        return CreditScoreResponse(
            wallet_address=request.wallet_address,
            credit_score=result["score"],
            score_breakdown=result["breakdown"],
            risk_level=result["risk_level"],
            confidence=result["confidence"]
        )
    except Exception as e:
        logger.error(f"Error calculating credit score: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ml/credit-score/batch")
async def calculate_batch_credit_scores(request: BatchCreditScoreRequest):
    """
    Calculate credit scores for multiple wallet addresses
    """
    try:
        scores = {}
        
        for address in request.wallet_addresses:
            blockchain_data = await blockchain_service.fetch_wallet_data(address)
            result = credit_score_service.calculate_score(blockchain_data)
            scores[address] = result["score"]
        
        return {"scores": scores}
    except Exception as e:
        logger.error(f"Error calculating batch credit scores: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ml/train")
async def train_model():
    """
    Trigger model training (admin endpoint - should be protected)
    """
    try:
        result = await credit_score_service.train_model()
        return result
    except Exception as e:
        logger.error(f"Error training model: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
