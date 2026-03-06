import os
import time
import logging
from datetime import datetime
from dotenv import load_dotenv
import schedule

from services.loan_monitor import LoanMonitor
from services.liquidator import Liquidator

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('liquidation_bot.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


class LiquidationBot:
    def __init__(self):
        self.loan_monitor = LoanMonitor()
        self.liquidator = Liquidator()
        self.check_interval = int(os.getenv("CHECK_INTERVAL_SECONDS", "60"))
        self.running = False

    def check_and_liquidate(self):
        """Check all active loans and liquidate if necessary"""
        try:
            logger.info("Starting liquidation check cycle...")
            
            # Get all active loans
            active_loans = self.loan_monitor.get_active_loans()
            logger.info(f"Found {len(active_loans)} active loans to monitor")
            
            liquidated_count = 0
            
            for loan in active_loans:
                loan_id = loan['loan_id']
                
                # Check health factor
                health_factor = self.loan_monitor.calculate_health_factor(loan)
                logger.info(f"Loan {loan_id}: Health Factor = {health_factor}")
                
                # If health factor is below threshold, liquidate
                if health_factor < 1.0:
                    logger.warning(f"Loan {loan_id} is underwater! Initiating liquidation...")
                    
                    try:
                        tx_hash = self.liquidator.liquidate_loan(loan_id, loan)
                        logger.info(f"Liquidation successful! TX: {tx_hash}")
                        liquidated_count += 1
                    except Exception as e:
                        logger.error(f"Liquidation failed for loan {loan_id}: {str(e)}")
            
            logger.info(f"Liquidation check cycle complete. Liquidated {liquidated_count} loans.")
            
        except Exception as e:
            logger.error(f"Error during liquidation check: {str(e)}")

    def start(self):
        """Start the liquidation bot"""
        logger.info("=" * 50)
        logger.info("Starting Vouch Liquidation Bot")
        logger.info(f"Check interval: {self.check_interval} seconds")
        logger.info("=" * 50)
        
        self.running = True
        
        # Schedule the check
        schedule.every(self.check_interval).seconds.do(self.check_and_liquidate)
        
        # Run immediately on start
        self.check_and_liquidate()
        
        # Main loop
        while self.running:
            schedule.run_pending()
            time.sleep(1)

    def stop(self):
        """Stop the liquidation bot"""
        logger.info("Stopping Liquidation Bot...")
        self.running = False


def main():
    bot = LiquidationBot()
    
    try:
        bot.start()
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
        bot.stop()
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        bot.stop()


if __name__ == "__main__":
    main()
