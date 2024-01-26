class TestConsumer {
    constructor(kafka, config) {
        this.consumer = kafka.consumer(config)
    }

    init = async (topic) => {
        await this.consumer.connect()
        await this.consumer
            .subscribe({topic, fromBeginning: true})
            .then(() => {
                console.log("Subscribed to ", topic);
            })
            .catch((reason) => console.log("can't subscribe: ", reason));
    }

    run = async () => {
        console.log("Listening: ")
        await this.consumer.run({
            eachMessage: async ({partition, message}) => {
                console.log("Event received: ", {
                    partition,
                    offset: message.offset,
                    value: message.value.toString(),
                });
                this.actual = JSON.parse(message.value.toString());
            },
        })
    }

    current = async ()=> {
        let loop = 0;
        while (this.actual === undefined && loop < 10) {
            await this.delay(50);
            loop++;
        }
        if (this.actual === undefined) {
            console.log("Message not recieved")
            throw "Message not received"
        }
        return this.actual
    }

    delay = (ms) => {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = {
    TestConsumer
}